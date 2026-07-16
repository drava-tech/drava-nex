import { Client } from 'pg';
const client = new Client({ connectionString: 'postgresql://cms_app:Ec-Db_2021_Digital_1331@192.168.0.250:5432/cms_db' });
async function run() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "token" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "ip_address" text,
      "user_agent" text,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS session_token_unique_idx ON "session"("token");
  `);
  console.log('Created session table successfully.');
  await client.end();
}
run().catch(console.error);
