// Placeholder Database Client and Schema definitions (Drizzle ORM setup location)
// @platform/types are used via type exports — import them as types for documentation
export type {
  Screen,
  Content,
  Playlist,
  PlaylistItem,
  Schedule,
  Rule,
} from '@platform/types';

// Placeholder database client (replace with Drizzle + pg/postgres connection)
export const dbClient = {
  connect: () => console.info('[db] Database client placeholder connected.'),
  query: async (sql: string) => {
    console.info(`[db] Executing query: ${sql}`);
    return [];
  },
};

// Placeholder schema representation for Drizzle ORM setup
export const schema = {
  screens: 'screens_table_definition_placeholder',
  content: 'content_table_definition_placeholder',
  playlists: 'playlists_table_definition_placeholder',
  schedules: 'schedules_table_definition_placeholder',
  rules: 'rules_table_definition_placeholder',
} as const;

export type DatabaseType = typeof dbClient;
