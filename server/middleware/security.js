const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Security headers. CSP kept fairly strict - this site has no third
// party scripts/styles at all, so default-src 'self' is enough.
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

// Basic bot/abuse protection on HTTP routes (socket-level actions like
// lobby creation are additionally throttled in server/index.js).
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { securityHeaders, generalLimiter };
