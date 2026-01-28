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

    async create(url: string, accessToken: string, name: string, tags: string[] = [], startDate?: string, endDate?: string) {
        const existing = await this.storeRepository.findOne({ where: { url } });
        if (existing) {
            // Update tags if provided
            if (tags.length > 0) {
                existing.tags = tags;
            }
            if (startDate) existing.startDate = new Date(startDate);
            if (endDate) existing.endDate = new Date(endDate);

            await this.storeRepository.save(existing);

            // Trigger sync for existing store to allow retries
            this.syncStoreData(existing).catch(err =>
                this.logger.error(`Re-sync failed for store ${url}`, err.stack)
            );
            return existing;
        }
        const store = this.storeRepository.create({
            url,
            accessToken,
            name,
            tags,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined
        });
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
            // 1. Determine Sync Range
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            let sinceStr = '';

            // Check if we have data to determine Soft Vs Hard sync
            const lastMetric = await this.storeRepository.manager.getRepository('DailyMetric').findOne({
                where: { store: { id: store.id } },
                order: { date: 'DESC' }
            });

            if (lastMetric && (lastMetric as any).date) {
                // SOFT SYNC: Start from last metric date
                sinceStr = (lastMetric as any).date;
                this.logger.log(`Soft Sync detected. Syncing from ${sinceStr} to ${todayStr}`);
            } else {
                // HARD SYNC: Reference Period Start - 3 Months
                let anchorDate = store.startDate ? new Date(store.startDate) : new Date();

                // If anchor date is in future, use today
                if (anchorDate > today) {
                    anchorDate = today;
                }

                // Subtract 3 months
                const sinceDate = new Date(anchorDate);
                sinceDate.setMonth(sinceDate.getMonth() - 3);

                sinceStr = sinceDate.toISOString().split('T')[0];
                this.logger.log(`Hard/Initial Sync detected. Syncing from ${sinceStr} (Ref Start - 3m) to ${todayStr}`);
            }

            // 2. Sync Product Metrics (Top Products) - New Logic
            this.logger.log(`Starting product metrics sync for store: ${store.name}`);
            try {
                // Use same time range as daily metrics
                const productAnalytics = await this.shopifyService.getProductAnalytics(
                    store.url,
                    store.accessToken,
                    sinceStr,
                    todayStr
                );

                this.logger.log(`Fetched ${productAnalytics.length} product metric records`);

                const productMetricRepo = this.storeRepository.manager.getRepository('ProductMetric');

                // We can either update or insert. Since we want history, we should upsert based on date+productTitle.
                // Note: Ideally we would use a unique constraint on [store, date, productTitle].

                for (const pData of productAnalytics) {
                    let pMetric = await productMetricRepo.findOne({
                        where: {
                            store: { id: store.id },
                            date: pData.date,
                            productTitle: pData.productTitle
                        }
                    }) as any;

                    if (!pMetric) {
                        pMetric = productMetricRepo.create({
                            store: store,
                            date: pData.date,
                            productTitle: pData.productTitle
                        });
                    }

                    pMetric.totalSales = pData.totalSales;
                    pMetric.netSales = pData.netSales;
                    pMetric.netItemsSold = pData.netItemsSold;

                    await productMetricRepo.save(pMetric);
                }
                this.logger.log(`Successfully synced product metrics`);

            } catch (err) {
                this.logger.warn(`Failed to sync product metrics: ${err.message}`);
                // We don't want to fail the whole sync if product metrics fail, just log it.
            }

            // 3. Sync Daily Metrics (New Architecture)
            this.logger.log(`Starting daily metrics sync for store: ${store.name}`);



            try {
                const analyticsData = await this.shopifyService.getDailyAnalytics(
                    store.url,
                    store.accessToken,
                    sinceStr,
                    todayStr
                );

                this.logger.log(`Fetched ${analyticsData.length} daily records from Shopify`);

                // Insert/Update metrics
                const dailyMetricRepo = this.storeRepository.manager.getRepository('DailyMetric');

                for (const data of analyticsData) {
                    // Check if exists
                    let metric = await dailyMetricRepo.findOne({
                        where: {
                            store: { id: store.id },
                            date: data.date
                        }
                    }) as any;

                    if (!metric) {
                        metric = dailyMetricRepo.create({
                            date: data.date,
                            store: store
                        });
                    }

                    // Update fields
                    metric.totalRevenue = data.totalSales;
                    metric.totalOrders = data.orders;
                    metric.averageOrderValue = data.averageOrderValue || 0;
                    metric.conversionRate = data.conversionRate || 0;
                    metric.sessions = data.sessions || 0;
                    metric.visits = data.sessions || 0; // Keeping visits mapped to sessions for potential legacy compat

                    await dailyMetricRepo.save(metric);
                }

                this.logger.log(`Successfully synced daily metrics`);

            } catch (error) {
                this.logger.error(`Failed to sync daily metrics for store ${store.name}`, error.message);
                throw error;
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
            throw error;
        }
    }
}

