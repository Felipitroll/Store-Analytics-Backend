import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, OneToMany } from 'typeorm';
import { Store } from '../../store/entities/store.entity';
import { LineItem } from './line-item.entity';

@Entity()
export class Order {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    shopifyId: string;

    @Column('decimal', { precision: 10, scale: 2 })
    totalPrice: number;

    @Column()
    currency: string;

    @CreateDateColumn()
    createdAt: Date;

    @Column()
    processedAt: Date;

    @ManyToOne(() => Store, (store) => store.orders, { onDelete: 'CASCADE' })
    store: Store;

    @OneToMany(() => LineItem, (lineItem) => lineItem.order, { cascade: true })
    lineItems: LineItem[];
}
