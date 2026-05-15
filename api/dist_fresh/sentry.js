"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sentry = exports.sentryRequestHandler = exports.initSentry = void 0;
const Sentry = __importStar(require("@sentry/node"));
exports.Sentry = Sentry;
function initSentry() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
        return;
    }
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.1,
    });
    console.log('[sentry] Error tracking initialized (env=%s)', process.env.NODE_ENV || 'production');
}
exports.initSentry = initSentry;
function sentryRequestHandler(req, _res, next) {
    Sentry.setUser({
        ip_address: req.ip,
        id: req.sessionId || undefined,
    });
    Sentry.setExtra('country', req.query.country || req.body?.country || '');
    Sentry.setTag('method', req.method);
    Sentry.setTag('path', req.path);
    next();
}
exports.sentryRequestHandler = sentryRequestHandler;
