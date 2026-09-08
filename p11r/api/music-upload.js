const { handleUpload } = require('@vercel/blob/client');
const { isAuthenticated } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak didukung.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isAuthenticated(req)) throw new Error('UNAUTHORIZED');
        return ({
        addRandomSuffix: true,
        allowedContentTypes: [
          'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/*'
        ],
        tokenPayload: JSON.stringify({ clientPayload: clientPayload || '', pathname }),
        });
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Gagal membuat token upload.' });
  }
};
