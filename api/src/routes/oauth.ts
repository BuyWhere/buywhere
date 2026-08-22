// OAuth 2.1 route scaffold (M1) — 501 with machine-readable contract.
// Real implementation lands per docs/oauth-design.md milestones.
import { Router, Request, Response } from 'express';
import { buildRegisterStub, buildTokenStub } from '../lib/oauthStubs';

const router = Router();

router.post('/register', (_req: Request, res: Response) => {
  res.status(501).json(buildRegisterStub());
});

router.post('/token', (_req: Request, res: Response) => {
  res.status(501).json(buildTokenStub());
});

// authorize/revoke intentionally 404 until their milestones — a 501 there would
// tempt clients into wiring flows that cannot complete.

export default router;
