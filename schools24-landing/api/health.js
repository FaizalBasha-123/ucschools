export default function handler(req, res) {
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  res
    .status(200)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .json({
      status: "healthy",
      app: "landing",
      timestamp: new Date().toISOString(),
    });
}
