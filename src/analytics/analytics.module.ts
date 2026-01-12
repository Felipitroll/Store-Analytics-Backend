import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { SessionMetric } from './entities/session-metric.entity';

import { LineItem } from './entities/line-item.entity';
import { Store } from '../store/entities/store.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Order, Product, LineItem, SessionMetric, Store])],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService]
})
export class AnalyticsModule { }
