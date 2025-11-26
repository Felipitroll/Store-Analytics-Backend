import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { LineItem } from './entities/line-item.entity';

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Order)
        private orderRepository: Repository<Order>,
        @InjectRepository(Product)
        private productRepository: Repository<Product>,
    ) { }

    async getStoreAnalytics(storeId: string, startDate?: string, endDate?: string) {
        // Helper to add date filter
        const addDateFilter = (query: any) => {
            if (startDate && endDate) {
                query.andWhere('order.processedAt BETWEEN :startDate AND :endDate', {
                    startDate: new Date(startDate),
                    endDate: new Date(endDate)
                });
            }
            return query;
        };

        // 1. Total Revenue and Orders
        let revenueQuery = this.orderRepository
            .createQueryBuilder('order')
            .select('SUM(order.totalPrice)', 'totalRevenue')
            .addSelect('COUNT(order.id)', 'totalOrders')
            .where('order.storeId = :storeId', { storeId });

        revenueQuery = addDateFilter(revenueQuery);

        const { totalRevenue, totalOrders } = await revenueQuery.getRawOne();

        // 2. Sales Over Time (Dynamic Grouping)
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const end = endDate ? new Date(endDate) : new Date();
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let dbInterval = 'month';
        if (diffDays <= 14) {
            dbInterval = 'day';
        } else if (diffDays <= 60) {
            dbInterval = 'week';
        }

        console.log('Analytics Debug:', { startDate, endDate, diffDays, dbInterval });

        let salesQuery = this.orderRepository
            .createQueryBuilder('order')
            .select(`DATE_TRUNC('${dbInterval}', order.processedAt)`, 'date')
            .addSelect('SUM(order.totalPrice)', 'value')
            .where('order.storeId = :storeId', { storeId });

        salesQuery = addDateFilter(salesQuery);

        const salesResults = await salesQuery
            .groupBy(`DATE_TRUNC('${dbInterval}', order.processedAt)`)
            .orderBy(`DATE_TRUNC('${dbInterval}', order.processedAt)`, 'ASC')
            .getRawMany();

        console.log('Sales Results:', salesResults);

        // Fill gaps
        const salesOverTime = [];
        const currentDate = new Date(start);

        // Normalize start date to match DATE_TRUNC
        currentDate.setHours(0, 0, 0, 0);
        if (dbInterval === 'week') {
            const day = currentDate.getDay();
            const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
            currentDate.setDate(diff);
        } else if (dbInterval === 'month') {
            currentDate.setDate(1);
        }

        const endDateObj = new Date(end);
        // Add buffer to end date to ensure we cover the range, especially for weeks/months
        endDateObj.setHours(23, 59, 59, 999);

        console.log('Loop Start:', currentDate.toISOString(), 'End:', endDateObj.toISOString());

        while (currentDate <= endDateObj) {
            // Find match
            const match = salesResults.find(item => {
                const itemDate = new Date(item.date);
                return itemDate.toISOString().split('T')[0] === currentDate.toISOString().split('T')[0];
            });

            let name = '';
            if (dbInterval === 'day') {
                name = currentDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            } else if (dbInterval === 'week') {
                const endOfWeek = new Date(currentDate);
                endOfWeek.setDate(currentDate.getDate() + 6);

                const startMonth = currentDate.toLocaleDateString('en-US', { month: 'short' });
                const endMonth = endOfWeek.toLocaleDateString('en-US', { month: 'short' });

                if (startMonth === endMonth) {
                    name = `${currentDate.getDate()} - ${endOfWeek.getDate()} ${startMonth}`;
                } else {
                    name = `${currentDate.getDate()} ${startMonth} - ${endOfWeek.getDate()} ${endMonth}`;
                }
            } else {
                name = currentDate.toLocaleDateString('en-US', { month: 'short' });
            }

            salesOverTime.push({
                name,
                value: match ? parseFloat(match.value) : 0
            });

            // Increment
            if (dbInterval === 'day') {
                currentDate.setDate(currentDate.getDate() + 1);
            } else if (dbInterval === 'week') {
                currentDate.setDate(currentDate.getDate() + 7);
            } else {
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
        }
        console.log('Generated SalesOverTime:', salesOverTime.length, 'items');

        // 3. Top Products (Real Data from LineItems)
        let topProductsQuery = this.orderRepository.manager
            .createQueryBuilder(LineItem, 'lineItem')
            .select('lineItem.title', 'title')
            .addSelect('SUM(lineItem.quantity)', 'totalQuantity')
            .addSelect('SUM(lineItem.quantity * lineItem.price)', 'totalSales')
            .innerJoin('lineItem.order', 'order')
            .where('order.storeId = :storeId', { storeId })
            .groupBy('lineItem.title')
            .orderBy('"totalSales"', 'DESC')
            .limit(5);

        if (startDate && endDate) {
            topProductsQuery.andWhere('order.processedAt BETWEEN :startDate AND :endDate', {
                startDate: new Date(startDate),
                endDate: new Date(endDate)
            });
        }

        const topProducts = await topProductsQuery.getRawMany();

        // Calculate Average Order Value (AOV)
        const revenue = parseFloat(totalRevenue || '0');
        const orders = parseInt(totalOrders || '0');
        const averageOrderValue = orders > 0 ? revenue / orders : 0;

        return {
            totalRevenue: revenue,
            totalOrders: orders,
            averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
            salesOverTime: salesOverTime,
            topProducts: topProducts.map(p => ({
                id: p.title,
                title: p.title,
                totalSales: parseFloat(p.totalSales)
            }))
        };
    }
}
