# 普拉魂 Admin 帳號設定

> 第一次 deploy 後執行一次。設定完就能 https://plasoul.com/admin/login 登入。

## Step 1: 設 JWT_SECRET（Cloudflare Pages env var）

打開 Cloudflare dashboard：
https://dash.cloudflare.com/9d1c433cd1765f0b56c251977a9ea28b/pages/view/plasoul/settings

1. 點 **Settings** tab → 找 **Environment variables**
2. 點 **Add variable**
3. 設定：
   ```
   Variable name:  JWT_SECRET
   Value:          <隨機字串 32+ 字元，例：openssl rand -base64 32 產的>
   Environment:    Production (☑) + Preview (☑)
   Type:           Secret（隱藏值）
   ```
4. 點 Save

**產生隨機 secret 的方法**（任選一個跑）：

PowerShell:
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Linux/Mac:
```bash
openssl rand -base64 32
```

或者直接用線上 https://generate-secret.vercel.app/32

## Step 2: Seed 第一個 admin 帳號

```powershell
cd "C:\Users\USER\Desktop\case\20260321_鋼普拉比價\001_普拉魂"

# 算 hash + 產生 INSERT command（會 print 出來，不會自動跑）
node scripts/setup-admin.mjs fightmon@gmail.com '你的強密碼'
```

它會 print 出一行 `npx wrangler d1 execute ...` 指令，**複製貼上跑**：

```powershell
# 直接複製上一步 print 出的 command，會把 admin 寫進 plasoul-db
npx wrangler d1 execute plasoul-db --remote --command "INSERT INTO users ..."
```

## Step 3: Push code 到 GitHub（觸發 Cloudflare Pages deploy）

```powershell
git add -A
git commit -m "feat(auth): W3-A admin login (PBKDF2 + JWT HS256)"
git push
```

Cloudflare Pages 自動 build + deploy（2-3 分鐘）。

## Step 4: 驗證

打開 https://plasoul.com/admin/login

輸入：
- Email: fightmon@gmail.com
- Password: 你剛設的密碼

成功 → redirect 到 /admin/listings（W3-B 還沒做，會 404 是正常的）

## 之後想換密碼？

```powershell
# 重新算 hash + 更新 D1
node scripts/setup-admin.mjs fightmon@gmail.com '新密碼'

# 跑出來的 INSERT command 改成 UPDATE：
# UPDATE users SET password_hash = '...', updated_at = ... WHERE email = 'fightmon@gmail.com'
```

或直接重新 INSERT 會碰到 UNIQUE constraint，要先 DELETE 或改成 UPDATE。

## 多加幾個 admin？

跑同樣 setup-admin.mjs 但用不同 email：
```powershell
node scripts/setup-admin.mjs partner@example.com '另一個密碼'
```

## 失敗 5 次會被鎖 15 分鐘

KV-based lockout。被鎖時等 15 分鐘自動解，或在 Cloudflare dashboard 手動清 KV key `rl:login:<email>:<ip>`。
