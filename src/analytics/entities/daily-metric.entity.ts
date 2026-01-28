import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Store } from '../../store/entities/store.entity';

@Entity()
export class DailyMetric {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'date' })
    date: string;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    totalRevenue: number;

    @Column('int', { default: 0 })
    totalOrders: number;

    @Column('int', { default: 0 })
    visits: number;

    @Column('int', { default: 0 })
    sessions: number;

    @Column('decimal', { precision: 10, scale: 4, default: 0 })
    conversionRate: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    averageOrderValue: number;

    @ManyToOne(() => Store, (store) => store.dailyMetrics)
    store: Store;
}
