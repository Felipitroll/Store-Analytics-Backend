import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from './entities/store.entity';
import { Order } from '../analytics/entities/order.entity';
import { Product } from '../analytics/entities/product.entity';
import { LineItem } from '../analytics/entities/line-item.entity';
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
        private shopifyService: ShopifyService,
    ) { }

    async create(url: string, accessToken: string, name: string) {
        const existing = await this.storeRepository.findOne({ where: { url } });
        if (existing) {
            // Trigger sync for existing store to allow retries
            this.syncStoreData(existing).catch(err =>
                this.logger.error(`Re-sync failed for store ${url}`, err.stack)
            );
            return existing;
        }
        const store = this.storeRepository.create({ url, accessToken, name });
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
                const lineItems = sOrder.line_items.map((item: any) => {
                    const lineItem = new LineItem();
                    lineItem.shopifyId = item.id.toString();
                    lineItem.title = item.title;
                    lineItem.quantity = item.quantity;
                    lineItem.price = parseFloat(item.price);
                    return lineItem;
                });

                // Check if order exists
                const existing = await this.orderRepository.findOne({
                    where: { shopifyId: sOrder.id.toString() },
                    relations: ['lineItems']
                });

                if (existing) {
                    // Update existing order and replace line items
                    existing.totalPrice = sOrder.total_price;
                    existing.currency = sOrder.currency;
                    existing.processedAt = sOrder.processed_at ? new Date(sOrder.processed_at) : new Date(sOrder.created_at);
                    existing.lineItems = lineItems; // Replace with new line items
                    await this.orderRepository.save(existing); // Cascade will handle line items
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
            }

            // 2. Sync Products
            const shopifyProducts = await this.shopifyService.getProducts(store.url, store.accessToken);
            this.logger.log(`Fetched ${shopifyProducts.length} products from Shopify`);

            for (const sProduct of shopifyProducts) {
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
        }
    }
}
