import net from 'node:net';

const port = Number(process.env.PORT ?? process.env.REDIS_FAKE_PORT ?? 6379);
const strings = new Map();
const lists = new Map();
const sets = new Map();

const server = net.createServer((socket) => {
  console.log('[redis-fake] client connected');
  let buffer = Buffer.alloc(0);
  let protocol = 2;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const parsed = parseCommand(buffer);
      if (!parsed) {
        break;
      }
      buffer = buffer.subarray(parsed.bytesRead);
      console.log(`[redis-fake] ${parsed.command.join(' ')}`);
      const response = handleCommand(parsed.command, protocol);
      if (parsed.command[0]?.toUpperCase() === 'HELLO' && parsed.command[1] === '3') {
        protocol = 3;
      }
      socket.write(response);
    }
  });

  socket.on('error', (error) => {
    console.error(`[redis-fake] socket error: ${error.message}`);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[redis-fake] listening on 127.0.0.1:${port}`);
});

function parseCommand(buffer) {
  if (buffer[0] !== 42) {
    const end = buffer.indexOf('\r\n');
    if (end === -1) {
      return null;
    }
    const line = buffer.subarray(0, end).toString('utf8');
    return { command: line.split(/\s+/), bytesRead: end + 2 };
  }

  const firstLineEnd = buffer.indexOf('\r\n');
  if (firstLineEnd === -1) {
    return null;
  }
  const count = Number(buffer.subarray(1, firstLineEnd).toString('utf8'));
  let offset = firstLineEnd + 2;
  const command = [];

  for (let index = 0; index < count; index += 1) {
    if (buffer[offset] !== 36) {
      return null;
    }
    const lengthEnd = buffer.indexOf('\r\n', offset);
    if (lengthEnd === -1) {
      return null;
    }
    const length = Number(buffer.subarray(offset + 1, lengthEnd).toString('utf8'));
    const valueStart = lengthEnd + 2;
    const valueEnd = valueStart + length;
    if (buffer.length < valueEnd + 2) {
      return null;
    }
    command.push(buffer.subarray(valueStart, valueEnd).toString('utf8'));
    offset = valueEnd + 2;
  }

  return { command, bytesRead: offset };
}

function handleCommand(parts, protocol) {
  const [rawName, ...args] = parts;
  const name = rawName?.toUpperCase();

  switch (name) {
    case 'PING':
      return simple('PONG');
    case 'HELLO':
      return map({
        server: 'redis-fake',
        version: '0.0.1',
        proto: 3,
        id: 1,
        mode: 'standalone',
        role: 'master',
        modules: [],
      });
    case 'CLIENT':
      return simple('OK');
    case 'GET':
      return bulkOrNull(strings.get(args[0]), protocol);
    case 'SET':
      strings.set(args[0], args[1] ?? '');
      return simple('OK');
    case 'RPUSH': {
      const list = lists.get(args[0]) ?? [];
      list.push(...args.slice(1));
      lists.set(args[0], list);
      return integer(list.length);
    }
    case 'LPOP': {
      const list = lists.get(args[0]) ?? [];
      const value = list.shift();
      lists.set(args[0], list);
      return bulkOrNull(value, protocol);
    }
    case 'SADD': {
      const set = sets.get(args[0]) ?? new Set();
      let added = 0;
      for (const value of args.slice(1)) {
        if (!set.has(value)) {
          added += 1;
        }
        set.add(value);
      }
      sets.set(args[0], set);
      return integer(added);
    }
    case 'SMEMBERS': {
      const set = sets.get(args[0]) ?? new Set();
      return array([...set].map((value) => bulk(value)));
    }
    case 'DEL': {
      let deleted = 0;
      for (const key of args) {
        deleted += strings.delete(key) || lists.delete(key) || sets.delete(key) ? 1 : 0;
      }
      return integer(deleted);
    }
    default:
      return error(`unsupported command ${name ?? '(empty)'}`);
  }
}

function simple(value) {
  return `+${value}\r\n`;
}

function error(value) {
  return `-ERR ${value}\r\n`;
}

function integer(value) {
  return `:${value}\r\n`;
}

function bulkOrNull(value, protocol = 2) {
  if (value === undefined || value === null) {
    return protocol === 3 ? '_\r\n' : '$-1\r\n';
  }
  return bulk(value);
}

function bulk(value) {
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

function array(values) {
  return `*${values.length}\r\n${values.join('')}`;
}

function map(record) {
  const entries = Object.entries(record);
  return `%${entries.length}\r\n${entries
    .map(([key, value]) => `${bulk(key)}${Array.isArray(value) ? array(value) : typeof value === 'number' ? integer(value) : bulk(value)}`)
    .join('')}`;
}
