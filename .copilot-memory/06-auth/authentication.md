# Authentication

## Flow
1. User submits email + password
2. Backend validates credentials
3. JWT access token issued (24h expiry)
4. Refresh token issued (7 days expiry)
5. Tokens stored in localStorage (Remember Me) or sessionStorage
6. Middleware validates token on each request

## JWT Structure
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "role": "teacher",
  "school_id": "uuid",
  "session_id": "session_uuid",
  "exp": 1234567890,
  "iat": 1234567890,
  "nbf": 1234567890
}
```

## Endpoints
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/logout` - Logout (invalidate session)
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/validate-session` - Check session validity

## Token Storage
- **Web**: localStorage (Remember Me) or sessionStorage
- **Mobile**: localStorage (always)
- **Expiry**: Access token 24h, Refresh token 7d

## Session Management
- Active sessions tracked in DB
- Logout invalidates session
- User suspension blocks all sessions
- Multi-device support via device tokens

## Password Reset
- Email-based token
- Time-limited reset link
- Password strength validation

## Security
- Bcrypt password hashing
- CSRF tokens for mutations
- Rate limiting on login
- Account lockout after failed attempts
- Email verification (optional)
