import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from './entities/store.entity';
import { Order } from '../analytics/entities/order.entity';
import { Product } from '../analytics/entities/product.entity';
import { LineItem } from '../analytics/entities/line-item.entity';
import { SessionMetric } from '../analytics/entities/session-metric.entity';
import { ShopifyService } from '../shopify/shopify.service';

@Injectable()
export class StoreService {
    private readonly logger = new Logger(StoreService.name);

    constructor(
        @InjectRepository(Store)
        private storeRepository: Repository<Store>,
        @InjectRepository(Order)
        private orderRepository: Repository<Order>,
        @InjectRepository(Product)
        private productRepository: Repository<Product>,
        @InjectRepository(SessionMetric)
        private sessionMetricRepository: Repository<SessionMetric>,
        private shopifyService: ShopifyService,
    ) { }

    async create(url: string, accessToken: string, name: string, tags: string[] = []) {
        const existing = await this.storeRepository.findOne({ where: { url } });
        if (existing) {
            // Update tags if provided
            if (tags.length > 0) {
                existing.tags = tags;
                await this.storeRepository.save(existing);
            }
            // Trigger sync for existing store to allow retries
            this.syncStoreData(existing).catch(err =>
                this.logger.error(`Re-sync failed for store ${url}`, err.stack)
            );
            return existing;
        }
        const store = this.storeRepository.create({ url, accessToken, name, tags });
        const savedStore = await this.storeRepository.save(store);

        // Trigger initial sync asynchronously
        this.syncStoreData(savedStore).catch(err =>
            this.logger.error(`Initial sync failed for store ${url}`, err.stack)
        );

        return savedStore;
    }

    async findAll() {
        return this.storeRepository.find();
    }

    async findOne(id: string) {
        const store = await this.storeRepository.findOne({ where: { id } });
        if (!store) throw new NotFoundException(`Store with ID ${id} not found`);
        return store;
    }

    async remove(id: string) {
        const store = await this.findOne(id);
        return this.storeRepository.remove(store);
    }

    async update(id: string, updateData: Partial<Store>) {
        const store = await this.findOne(id);
        Object.assign(store, updateData);
        return this.storeRepository.save(store);
    }

    async syncStoreData(store: Store) {
        this.logger.log(`Starting sync for store: ${store.name}`);

        // Update status to SYNCING
        await this.storeRepository.update(store.id, { syncStatus: 'SYNCING' });

        try {
            // 1. Sync Orders
            const shopifyOrders = await this.shopifyService.getOrders(store.url, store.accessToken);
            this.logger.log(`Fetched ${shopifyOrders.length} orders from Shopify`);

            for (const sOrder of shopifyOrders) {
                try {
                    // Check if order exists
                    const existing = await this.orderRepository.findOne({
                        where: { shopifyId: sOrder.id.toString() },
                        relations: ['lineItems']
                    });

                    const lineItems = sOrder.line_items.map((item: any) => {
                        const lineItem = new LineItem();
                        lineItem.shopifyId = item.id.toString();
                        lineItem.title = item.title;
                        lineItem.quantity = item.quantity;
                        lineItem.price = parseFloat(item.price);

                        // If order exists, try to find the existing line item to preserve its ID
                        if (existing && existing.lineItems) {
                            const existingItem = existing.lineItems.find(li => li.shopifyId === lineItem.shopifyId);
                            if (existingItem) {
                                lineItem.id = existingItem.id;
                            }
                        }
                        return lineItem;
                    });

                    if (existing) {
                        // Update existing order
                        existing.totalPrice = sOrder.total_price;
                        existing.currency = sOrder.currency;
                        existing.processedAt = sOrder.processed_at ? new Date(sOrder.processed_at) : new Date(sOrder.created_at);
                        existing.lineItems = lineItems;
                        await this.orderRepository.save(existing);
                    } else {
                        // Create new order
                        const order = this.orderRepository.create({
                            shopifyId: sOrder.id.toString(),
                            totalPrice: sOrder.total_price,
                            currency: sOrder.currency,
                            createdAt: new Date(sOrder.created_at),
                            processedAt: sOrder.processed_at ? new Date(sOrder.processed_at) : new Date(sOrder.created_at),
                            store: store,
                            lineItems: lineItems,
                        });
                        await this.orderRepository.save(order);
                    }
                } catch (err) {
                    this.logger.warn(`Failed to sync order ${sOrder.id}: ${err.message}`);
                }
            }

            // 2. Sync Products
            const shopifyProducts = await this.shopifyService.getProducts(store.url, store.accessToken);
            this.logger.log(`Fetched ${shopifyProducts.length} products from Shopify`);

            for (const sProduct of shopifyProducts) {
                try {
                    const product = this.productRepository.create({
                        shopifyId: sProduct.id.toString(),
                        title: sProduct.title,
                        store: store,
                    });

                    const existing = await this.productRepository.findOne({ where: { shopifyId: product.shopifyId } });
                    if (existing) {
                        await this.productRepository.update(existing.id, product);
                    } else {
                        await this.productRepository.save(product);
                    }
                } catch (err) {
                    this.logger.warn(`Failed to sync product ${sProduct.id}: ${err.message}`);
                }
            }

            // 3. Sync Session Metrics (historical data)
            this.logger.log(`Starting session metrics sync for store: ${store.name}`);

            // Calculate date range: from store creation (or 1 year ago) to today
            const endDate = new Date();
            const startDate = store.createdAt ? new Date(store.createdAt) : new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

            // Format dates for Shopify API (YYYY-MM-DD)
            const formatDate = (date: Date) => date.toISOString().split('T')[0];
            const startDateStr = formatDate(startDate);
            const endDateStr = formatDate(endDate);

            this.logger.log(`Fetching session metrics from ${startDateStr} to ${endDateStr}`);

            try {
                const sessionData = await this.shopifyService.getSessionMetrics(
                    store.url,
                    store.accessToken,
                    startDateStr,
                    endDateStr
                );

                this.logger.log(`Fetched ${sessionData.length} session metric records from Shopify`);

                // AGGRESSIVE CLEANUP: Delete all existing metrics for this store to avoid conflicts
                this.logger.log(`Cleaning up existing session metrics...`);
                await this.sessionMetricRepository.createQueryBuilder()
                    .delete()
                    .where("storeId = :storeId", { storeId: store.id })
                    .execute();

                this.logger.log(`Inserting ${sessionData.length} new session metrics...`);

                // Save one by one and IGNORE ALL ERRORS to ensure completion
                for (const data of sessionData) {
                    const metric = this.sessionMetricRepository.create({
                        date: (data as any).date,
                        sessions: (data as any).sessions,
                        conversionRate: (data as any).conversionRate ?? undefined,
                        store: store,
                    });
                    await this.sessionMetricRepository.save(metric);
                }

                this.logger.log(`Successfully synced ${sessionData.length} session metrics`);
            } catch (error) {
                this.logger.error(`Failed to sync session metrics for store ${store.name}`, error.message);
                // Don't fail the entire sync if session metrics fail
            }

            // Update status to COMPLETED
            await this.storeRepository.update(store.id, {
                syncStatus: 'COMPLETED',
                lastSyncAt: new Date()
            });
            this.logger.log(`Sync completed for store: ${store.name}`);

        } catch (error: any) {
            this.logger.error(`Sync failed for store ${store.name}`, error.stack);
            await this.storeRepository.update(store.id, { syncStatus: 'FAILED' });
            throw error; // Re-throw to let the controller know it failed
        }
    }
}

