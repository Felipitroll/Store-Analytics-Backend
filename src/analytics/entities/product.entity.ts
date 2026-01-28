import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Store } from '../../store/entities/store.entity';

@Entity()
export class Product {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    shopifyId: string;

    @Column()
    title: string;

    @Column({ nullable: true })
    handle: string;

    @Column({ nullable: true })
    image: string;

    @Column({ nullable: true })
    status: string;

    @Column('text', { array: true, default: '{}' })
    tags: string[];

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    totalSales: number;

    @ManyToOne(() => Store, (store) => store.products)
    store: Store;
}
