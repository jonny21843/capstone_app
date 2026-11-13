# StudyGrounds

This repository is being rebuilt from the original graduate capstone into a study-material publishing and discovery platform.

StudyGrounds lets users upload, organize, publish, and discover study material. Longer-term plans include searchable text extraction, quizzes, flashcards, and additional study tools.

## Current direction

The project is moving to a serverless AWS architecture:

- Amazon Cognito for user registration and sign-in
- Amazon CloudFront for the web frontend
- Amazon S3 for static frontend assets and uploaded source files
- Amazon API Gateway HTTP API for backend endpoints
- AWS Lambda for backend logic
- Amazon DynamoDB for note metadata, sharing permissions, study content, and usage records
- Amazon Textract for handwriting/OCR processing later

The previous EC2, Nginx, Flask, systemd, VPC, and Cloudflare Zero Trust deployment is no longer the target architecture.

## Authentication milestone

Authentication uses Cognito managed login with OAuth authorization code + PKCE:

1. The browser starts Cognito managed login with OAuth authorization code + PKCE.
2. Cognito redirects back to `/auth/callback.html`.
3. The callback exchanges the authorization code for tokens.
4. The frontend sends the Cognito access token to `GET /api/me`.
5. API Gateway validates the Cognito JWT.
6. Lambda returns the authenticated Cognito user ID.

The API Gateway/Lambda infrastructure is defined in:

```
infrastructure/template.yaml
```

The first Lambda function is:

```
backend/functions/me/app.py
```

## Existing prototype

The root-level `app.py`, `upload.js`, and `view.js` files are retained temporarily from the original capstone so useful upload and browsing behavior can be referenced while the application is migrated.

New backend functionality should be added under `backend/` and deployed through infrastructure-as-code instead of adding new Flask routes.

## Development configuration

Frontend Cognito configuration currently lives in `config.js`.

After the serverless API is deployed, set:

```javascript
apiBaseUrl: "https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com"
```

Do not commit AWS access keys, secret access keys, Cognito client secrets, access tokens, ID tokens, or refresh tokens.

## Planned milestones

- Cognito login and protected `/api/me`
- User-owned note metadata in DynamoDB
- User-specific presigned S3 uploads
- Handwriting/OCR processing
- Editable extracted notes
- Flashcard and quiz generation
- Sharing and public study sets
- Free and paid usage tiers
