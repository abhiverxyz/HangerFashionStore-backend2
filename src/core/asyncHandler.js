/**
 * Wraps async route handlers so rejections are passed to Express error middleware.
 * Use: router.get("/path", asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
