/**
 * 环境配置 - 多环境适配
 * 根据 NODE_ENV 导出不同环境的配置项
 */

const NODE_ENV = (process.env.NODE_ENV || `development`).trim().toLowerCase();

const isProduction = NODE_ENV === `production`;
const isStaging = NODE_ENV === `staging`;
const isLocal = NODE_ENV === `development` || NODE_ENV === `local` || !NODE_ENV;

// 本地 SQLite 数据库路径
const SQLITE_PATH = process.env.SQLITE_PATH || require(`path`).join(__dirname, `..`, `database.db`);

const env = {
  NODE_ENV,
  isProduction,
  isStaging,
  isLocal,

  // 数据库策略
  db: {
    useSQLite: isLocal,
    useSupabase: isProduction || isStaging,
    sqlitePath: SQLITE_PATH
  },

  // CORS 白名单（不含 localhost，由 index.js 统一管理）
  corsOrigins: {
    production: [
      `https://boardgame-ai.pages.dev`,
      `https://boardgame-hub.pages.dev`,
      `https://boardgame-hub-deploy.pages.dev`,
      `https://boardgame-hub.onrender.com`
    ],
    staging: [
      `https://boardgame-ai-staging.pages.dev`,
      `https://boardgame-hub-staging.onrender.com`,
      // Cloudflare Pages staging 部署（含所有子域名，如 f0d57769.boardgame-hub-deploy.pages.dev）
      // 子域名通配匹配逻辑在 index.js 的 origin 回调中实现
      `https://boardgame-hub-deploy.pages.dev`
    ]
  }
};

console.log(`[ENV] 当前环境: ${NODE_ENV} | 数据库策略: ${env.db.useSQLite ? `SQLite` : `Supabase`} | 本地模式: ${isLocal}`);

module.exports = env;
