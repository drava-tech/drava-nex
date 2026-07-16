import { Client } from 'pg';
const client = new Client({ connectionString: 'postgresql://cms_app:Ec-Db_2021_Digital_1331@192.168.0.250:5432/cms_db' });
async function run() {
  await client.connect();
  await client.query('DROP TABLE IF EXISTS session CASCADE');
  console.log('Dropped session table');
  await client.end();
}
run().catch(console.error);
