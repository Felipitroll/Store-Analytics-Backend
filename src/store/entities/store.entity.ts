import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { Order } from '../../analytics/entities/order.entity';
import { Product } from '../../analytics/entities/product.entity';
import { DailyMetric } from '../../analytics/entities/daily-metric.entity';

@Entity()
export class Store {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    url: string;

    @Column()
    accessToken: string;

    @Column()
    name: string;

    @Column({
        type: 'enum',
        enum: ['PENDING', 'SYNCING', 'COMPLETED', 'FAILED'],
        default: 'PENDING'
    })
    syncStatus: 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';

    @Column({ nullable: true })
    lastSyncAt: Date;

    @Column({ nullable: true })
    startDate: Date;

    @Column({ nullable: true })
    endDate: Date;

    @CreateDateColumn()
    createdAt: Date;

    @OneToMany(() => Order, (order) => order.store)
    orders: Order[];

    @OneToMany(() => Product, (product) => product.store)
    products: Product[];

    @OneToMany(() => DailyMetric, (metric) => metric.store)
    dailyMetrics: DailyMetric[];
}
