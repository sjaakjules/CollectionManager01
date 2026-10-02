# Sorcery PHP Backend

This folder is copied into the deployed web root as `/api`. It preserves the same same-origin API paths used by the React app:

- `POST /api/signup`
- `POST /api/login`
- `GET /api/user/{userId}/data`
- `PUT /api/user/{userId}/data`
- `GET/POST /api/decks/*` — forwards to `https://sorcerytcg.com/*` with shared throttling
- `GET/POST /api/curiosa/*` — compatibility alias for the same deck proxy
- `GET/POST /api/sorcery/*`

`shared/user-data.php` normalizes the shared guest/account JSON contract.
Preserve `removedDecks` (deck ID → ISO removal time) when saving accounts;
the frontend uses it to prevent old guest/seed copies restoring a removed deck.
The backend stores this field with the JSON blob; no database migration is needed.
`scripts/user-data.test.mjs` checks round-trip compatibility using local PHP.

Both upstream proxies enforce the [SorceryTCG request policy](../../docs/sorcery-request-policy.md).
Cards, decks, search and the legacy alias share the `sorcerytcg` file-lock namespace:
one request at a time, at least 3000ms after completion or failure, and the longer
of `Retry-After` and a low-budget reset. The PHP proxy never retries or follows
redirects. A required wait above 8000ms returns 429 with `Retry-After` without
contacting SorceryTCG. Headerless upstream 429/503 responses block the shared
budget for 60 seconds. Missing limiter configuration cannot disable throttling.

State must be writable in the PHP temp directory. Keep its state/lock files
shared across routes; do not delete them to reset the allowance. Independent
PHP hosts require a shared external limiter before scaling. Offline PHP tests
in `scripts/proxy-rate-limit.test.mjs` verify deadlines and process locking.

Runtime database credentials are intentionally outside git and outside the web root:

- Production: `/home/julianru/sorcery_private/prod.php`
- Staging: `/home/julianru/sorcery_private/staging.php`

Each file should return an array like this, with real values supplied in cPanel:

```php
<?php
return [
  'db' => [
    'host' => 'localhost',
    'database' => 'julianru_sorcery_prod',
    'user' => 'julianru_sorcery_prod_user',
    'password' => 'use-cpanel-password-manager-or-keychain-source',
  ],
];
```

Do not deploy this README as configuration, and do not commit real credentials.
