import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { LineItem } from './entities/line-item.entity';
import { SessionMetric } from './entities/session-metric.entity';

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Order)
        private orderRepository: Repository<Order>,
        @InjectRepository(Product)
        private productRepository: Repository<Product>,
        @InjectRepository(SessionMetric)
        private sessionMetricRepository: Repository<SessionMetric>,
    ) { }

    async getStoreAnalytics(storeId: string, startDate?: string, endDate?: string, comparisonPeriod?: 'previous_period' | 'last_month' | 'last_year') {
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const end = endDate ? new Date(endDate) : new Date();

        // Helper to calculate comparison range
        const getComparisonRange = () => {
            if (!comparisonPeriod || comparisonPeriod === 'none' as any) return null;

            const compStart = new Date(start);
            const compEnd = new Date(end);
            const duration = end.getTime() - start.getTime();

            if (comparisonPeriod === 'previous_period') {
                compStart.setTime(start.getTime() - duration - (24 * 60 * 60 * 1000)); // Subtract duration + 1 day to avoid overlap
                compEnd.setTime(start.getTime() - (24 * 60 * 60 * 1000));
            } else if (comparisonPeriod === 'last_month') {
                compStart.setMonth(start.getMonth() - 1);
                compEnd.setMonth(end.getMonth() - 1);
            } else if (comparisonPeriod === 'last_year') {
                compStart.setFullYear(start.getFullYear() - 1);
                compEnd.setFullYear(end.getFullYear() - 1);
            }

            return { start: compStart, end: compEnd };
        };

        const comparisonRange = getComparisonRange();

        // Helper for queries
        const getMetrics = async (s: Date, e: Date) => {
            // 1. Total Revenue and Orders
            const { totalRevenue, totalOrders } = await this.orderRepository
                .createQueryBuilder('order')
                .select('SUM(order.totalPrice)', 'totalRevenue')
                .addSelect('COUNT(order.id)', 'totalOrders')
                .where('order.storeId = :storeId', { storeId })
                .andWhere('order.processedAt BETWEEN :start AND :end', { start: s, end: e })
                .getRawOne();

            // 2. Session Metrics
            const sessionMetrics = await this.sessionMetricRepository
                .createQueryBuilder('metric')
                .select('SUM(metric.sessions)', 'totalSessions')
                .addSelect('AVG(metric.conversionRate)', 'avgCR')
                .where('metric.storeId = :storeId', { storeId })
                .andWhere('metric.date BETWEEN :start AND :end', {
                    start: s.toISOString().split('T')[0],
                    end: e.toISOString().split('T')[0]
                })
                .getRawOne();

            const revenue = parseFloat(totalRevenue || '0');
            const orders = parseInt(totalOrders || '0');
            const aov = orders > 0 ? revenue / orders : 0;
            const sessions = parseInt(sessionMetrics.totalSessions || '0');
            const cr = parseFloat(sessionMetrics.avgCR || '0');

            return { revenue, orders, aov, sessions, cr };
        };

        const currentMetrics = await getMetrics(start, end);
        let comparisonMetrics = null;
        if (comparisonRange) {
            comparisonMetrics = await getMetrics(comparisonRange.start, comparisonRange.end);
        }

        // Helper to calculate % change
        const calculateChange = (current: number, previous: number) => {
            if (!previous || previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        // 2. Sales Over Time (Dynamic Grouping)
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let dbInterval = 'month';
        if (diffDays <= 14) {
            dbInterval = 'day';
        } else if (diffDays <= 60) {
            dbInterval = 'week';
        }

        const salesResults = await this.orderRepository
            .createQueryBuilder('order')
            .select(`DATE_TRUNC('${dbInterval}', order.processedAt)`, 'date')
            .addSelect('SUM(order.totalPrice)', 'value')
            .where('order.storeId = :storeId', { storeId })
            .andWhere('order.processedAt BETWEEN :start AND :end', { start, end })
            .groupBy(`DATE_TRUNC('${dbInterval}', order.processedAt)`)
            .orderBy(`DATE_TRUNC('${dbInterval}', order.processedAt)`, 'ASC')
            .getRawMany();

        // Fill gaps
        const salesOverTime = [];
        const currentDate = new Date(start);
        currentDate.setHours(0, 0, 0, 0);
        if (dbInterval === 'week') {
            const day = currentDate.getDay();
            const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1);
            currentDate.setDate(diff);
        } else if (dbInterval === 'month') {
            currentDate.setDate(1);
        }

        const endDateObj = new Date(end);
        endDateObj.setHours(23, 59, 59, 999);

        while (currentDate <= endDateObj) {
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
                name = startMonth === endMonth ? `${currentDate.getDate()} - ${endOfWeek.getDate()} ${startMonth}` : `${currentDate.getDate()} ${startMonth} - ${endOfWeek.getDate()} ${endMonth}`;
            } else {
                name = currentDate.toLocaleDateString('en-US', { month: 'short' });
            }

            salesOverTime.push({
                name,
                value: match ? parseFloat(match.value) : 0
            });

            if (dbInterval === 'day') currentDate.setDate(currentDate.getDate() + 1);
            else if (dbInterval === 'week') currentDate.setDate(currentDate.getDate() + 7);
            else currentDate.setMonth(currentDate.getMonth() + 1);
        }

        // 3. Top Products
        const topProducts = await this.orderRepository.manager
            .createQueryBuilder(LineItem, 'lineItem')
            .select('lineItem.title', 'title')
            .addSelect('SUM(lineItem.quantity)', 'totalQuantity')
            .addSelect('SUM(lineItem.quantity * lineItem.price)', 'totalSales')
            .innerJoin('lineItem.order', 'order')
            .where('order.storeId = :storeId', { storeId })
            .andWhere('order.processedAt BETWEEN :start AND :end', { start, end })
            .groupBy('lineItem.title')
            .orderBy('"totalSales"', 'DESC')
            .limit(5)
            .getRawMany();

        return {
            totalRevenue: currentMetrics.revenue,
            totalOrders: currentMetrics.orders,
            averageOrderValue: parseFloat(currentMetrics.aov.toFixed(2)),
            totalSessions: currentMetrics.sessions,
            conversionRate: parseFloat((currentMetrics.cr * 100).toFixed(2)),
            comparison: comparisonMetrics ? {
                totalRevenueChange: calculateChange(currentMetrics.revenue, comparisonMetrics.revenue),
                totalOrdersChange: calculateChange(currentMetrics.orders, comparisonMetrics.orders),
                averageOrderValueChange: calculateChange(currentMetrics.aov, comparisonMetrics.aov),
                totalSessionsChange: calculateChange(currentMetrics.sessions, comparisonMetrics.sessions),
                conversionRateChange: calculateChange(currentMetrics.cr, comparisonMetrics.cr),
            } : null,
            salesOverTime: salesOverTime,
            topProducts: topProducts.map(p => ({
                id: p.title,
                title: p.title,
                totalSales: parseFloat(p.totalSales)
            }))
        };
    }

    async getSessionMetrics(storeId: string, startDate?: string, endDate?: string) {
        let query = this.sessionMetricRepository
            .createQueryBuilder('metric')
            .where('metric.storeId = :storeId', { storeId })
            .orderBy('metric.date', 'ASC');

        if (startDate && endDate) {
            query = query.andWhere('metric.date BETWEEN :startDate AND :endDate', {
                startDate,
                endDate
            });
        }

        const metrics = await query.getMany();

        return {
            sessions: metrics.map(m => ({
                date: m.date,
                sessions: m.sessions,
                conversionRate: m.conversionRate ? parseFloat(m.conversionRate.toString()) : null
            }))
        };
    }
}
