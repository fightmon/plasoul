-- ==========================================================================
-- 0008 · catalog FTS5 index
-- 2026-06-02
-- ==========================================================================
-- 動機：
--   LIKE '%kw%' 對中文搜尋差（無法分詞、無排序、全表掃描）
--   FTS5 內建 unicode61 tokenizer 支援中英混合，trigram 模式對中文友善
--
-- 用法：
--   SELECT c.* FROM catalog c
--   JOIN catalog_fts fts ON fts.rowid = c.rowid
--   WHERE catalog_fts MATCH ?
--   ORDER BY rank
--
-- 同步策略：三個 trigger 自動同步 catalog → catalog_fts
-- ==========================================================================

-- 1. FTS5 virtual table（content link 回 catalog）
CREATE VIRTUAL TABLE catalog_fts USING fts5(
  full_name,
  name_jp,
  name_en,
  series,
  franchise,
  search_text,
  content='catalog',
  content_rowid='rowid',
  tokenize='trigram'
);

-- 2. backfill 既有 catalog 資料
INSERT INTO catalog_fts (rowid, full_name, name_jp, name_en, series, franchise, search_text)
SELECT rowid, full_name, name_jp, name_en, series, franchise, search_text FROM catalog;

-- 3. INSERT trigger
CREATE TRIGGER catalog_ai AFTER INSERT ON catalog BEGIN
  INSERT INTO catalog_fts (rowid, full_name, name_jp, name_en, series, franchise, search_text)
  VALUES (new.rowid, new.full_name, new.name_jp, new.name_en, new.series, new.franchise, new.search_text);
END;

-- 4. DELETE trigger（FTS5 contentless-delete syntax）
CREATE TRIGGER catalog_ad AFTER DELETE ON catalog BEGIN
  INSERT INTO catalog_fts (catalog_fts, rowid, full_name, name_jp, name_en, series, franchise, search_text)
  VALUES ('delete', old.rowid, old.full_name, old.name_jp, old.name_en, old.series, old.franchise, old.search_text);
END;

-- 5. UPDATE trigger
CREATE TRIGGER catalog_au AFTER UPDATE ON catalog BEGIN
  INSERT INTO catalog_fts (catalog_fts, rowid, full_name, name_jp, name_en, series, franchise, search_text)
  VALUES ('delete', old.rowid, old.full_name, old.name_jp, old.name_en, old.series, old.franchise, old.search_text);
  INSERT INTO catalog_fts (rowid, full_name, name_jp, name_en, series, franchise, search_text)
  VALUES (new.rowid, new.full_name, new.name_jp, new.name_en, new.series, new.franchise, new.search_text);
END;
