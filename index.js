const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const fsp = fs.promises;

const PORT = process.env.PORT || 3001;
const USERS_FILE_PATH = path.join(__dirname, 'data', 'users.json');
const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

const isAuthorized = (req) => {
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' && API_KEYS.includes(apiKey);
};

const isBrowserNavigationRequest = (req) => {
  const acceptHeader = req.headers.accept || '';
  const secFetchDest = req.headers['sec-fetch-dest'];
  const secFetchMode = req.headers['sec-fetch-mode'];
  const userAgent = req.headers['user-agent'] || '';

  const isHtmlNavigation =
    secFetchDest === 'document' ||
    secFetchMode === 'navigate' ||
    acceptHeader.includes('text/html');

  return isHtmlNavigation && userAgent.includes('Mozilla');
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const parseJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      // Guard against very large payloads for this simple demo API.
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', () => {
      reject(new Error('Request stream error'));
    });
  });

const readUsers = async () => {
  const raw = await fsp.readFile(USERS_FILE_PATH, 'utf8');
  const users = JSON.parse(raw);

  if (!Array.isArray(users)) {
    throw new Error('users.json must contain an array');
  }

  return users;
};

const writeUsers = async (users) => {
  await fsp.writeFile(USERS_FILE_PATH, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
};

const ensureUsersFile = async () => {
  const usersDir = path.dirname(USERS_FILE_PATH);
  await fsp.mkdir(usersDir, { recursive: true });

  try {
    await fsp.access(USERS_FILE_PATH);
  } catch {
    const seedUsers = [
      { id: 'u1', name: 'Ariana Moss', email: 'ariana@example.com' },
      { id: 'u2', name: 'Jared Cole', email: 'jared@example.com' },
      { id: 'u3', name: 'Nina Park', email: 'nina@example.com' },
    ];
    await writeUsers(seedUsers);
  }
};

const sendFile = (res, filePath, contentType) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
};

const respondSyntaxDemo500 = (res) => {
  try {
    // Intentionally compile invalid code to simulate a syntax failure at runtime.
    // eslint-disable-next-line no-new-func
    const brokenFn = new Function('const broken = ;');
    brokenFn();
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Intentional syntax failure for demo',
        code: 'DEMO_SYNTAX_500',
        detail: error.message,
        timestamp: new Date().toISOString(),
      })
    );
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const requestUrl = url.pathname;

  if (requestUrl === '/' || requestUrl === '/index.html') {
    return sendFile(
      res,
      path.join(__dirname, 'public', 'index.html'),
      'text/html; charset=utf-8'
    );
  }

  if (requestUrl === '/styles.css') {
    return sendFile(
      res,
      path.join(__dirname, 'public', 'styles.css'),
      'text/css; charset=utf-8'
    );
  }

  if (requestUrl === '/demo/5xx') {
    return sendFile(
      res,
      path.join(__dirname, 'public', 'demo-5xx.html'),
      'text/html; charset=utf-8'
    );
  }

  if (requestUrl === '/demo/5xx/syntax-error') {
    respondSyntaxDemo500(res);
    return;
  }

  if (requestUrl.startsWith('/api')) {
    if (isBrowserNavigationRequest(req)) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (API_KEYS.length === 0) {
      sendJson(res, 500, {
        error: 'Server misconfiguration: no API keys found in .env',
      });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Provide a valid API key in the x-api-key header.',
      });
      return;
    }

    if (requestUrl === '/api/demo/force-500') {
      sendJson(res, 500, {
        error: 'Intentional server error for demo',
        code: 'DEMO_INTENTIONAL_500',
        message: 'This endpoint always returns HTTP 500 for classroom exercises.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (requestUrl === '/api/users' && req.method === 'GET') {
      try {
        const users = await readUsers();
        sendJson(res, 200, { data: users, total: users.length });
      } catch (error) {
        sendJson(res, 500, {
          error: 'Failed to read users data',
          detail: error.message,
        });
      }
      return;
    }

    const userIdMatch = requestUrl.match(/^\/api\/users\/([^/]+)$/);
    if (userIdMatch && req.method === 'PUT') {
      const userId = decodeURIComponent(userIdMatch[1]);

      try {
        const payload = await parseJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { error: 'Body must be a JSON object' });
          return;
        }

        const users = await readUsers();
        const targetIndex = users.findIndex((user) => user.id === userId);

        if (targetIndex === -1) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }

        const nextUser = {
          ...users[targetIndex],
          ...payload,
          id: users[targetIndex].id,
          updatedAt: new Date().toISOString(),
        };
        users[targetIndex] = nextUser;

        await writeUsers(users);
        sendJson(res, 200, { message: 'User updated', data: nextUser });
      } catch (error) {
        const statusCode = error.message === 'Invalid JSON body' ? 400 : 500;
        sendJson(res, statusCode, {
          error: statusCode === 400 ? 'Invalid request body' : 'Failed to update user',
          detail: error.message,
        });
      }
      return;
    }

    if (userIdMatch && req.method === 'DELETE') {
      const userId = decodeURIComponent(userIdMatch[1]);

      try {
        const users = await readUsers();
        const targetIndex = users.findIndex((user) => user.id === userId);

        if (targetIndex === -1) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }

        const [deletedUser] = users.splice(targetIndex, 1);
        await writeUsers(users);

        sendJson(res, 200, { message: 'User deleted', data: deletedUser });
      } catch (error) {
        sendJson(res, 500, {
          error: 'Failed to delete user',
          detail: error.message,
        });
      }
      return;
    }

    if (requestUrl === '/api/users') {
      sendJson(res, 405, { error: 'Method not allowed', allowedMethods: ['GET'] });
      return;
    }

    if (userIdMatch) {
      sendJson(res, 405, { error: 'Method not allowed', allowedMethods: ['PUT', 'DELETE'] });
      return;
    }

    sendJson(res, 200, {
      message: 'Welcome to the API',
      path: requestUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404</h1><p>Page not found.</p>');
});

ensureUsersFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize users data:', error.message);
    process.exit(1);
  });
