// GET /api/report?id=<20-char id>  -> saved audit report JSON
const { getReport } = require('../lib/store');

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || '').toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(id)) return res.status(400).json({ error: 'Bad report id.' });
  try {
    const r = await getReport(id);
    if (!r) return res.status(404).json({ error: 'This report has expired or does not exist.' });
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(r);
  } catch {
    return res.status(502).json({ error: 'Could not load the report. Please try again.' });
  }
};
