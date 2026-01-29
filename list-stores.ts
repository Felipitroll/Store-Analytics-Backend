
import { DataSource } from 'typeorm';

async function listStores() {
    const ds = new DataSource({
        type: 'postgres',
        host: 'localhost',
        port: 5433,
        username: 'postgres',
        password: 'postgres_password',
        database: 'store_analytics'
    });
    await ds.initialize();

    const stores = await ds.query('SELECT id, name, url FROM store');
    console.table(stores);

    await ds.destroy();
}

listStores().catch(console.error);
