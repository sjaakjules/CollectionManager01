# Sorcery PHP Backend

This folder is copied into the deployed web root as `/api`. It preserves the same same-origin API paths used by the React app:

- `POST /api/signup`
- `POST /api/login`
- `GET /api/user/{userId}/data`
- `PUT /api/user/{userId}/data`
- `GET/POST /api/curiosa/*`
- `GET/POST /api/sorcery/*`

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
