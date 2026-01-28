import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, Index } from 'typeorm';
import { Store } from '../../store/entities/store.entity';

@Entity()
@Index(['store', 'date', 'productTitle'], { unique: true }) // Ensure uniqueness to prevent duplicates
export class ProductMetric {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    date: string;

    @Column()
    productTitle: string;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    totalSales: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    netSales: number;

    @Column('int', { default: 0 })
    netItemsSold: number;

    @ManyToOne(() => Store, (store) => store.productMetrics, { onDelete: 'CASCADE' })
    store: Store;
}
