// -----------------------------------------------------------------------------
// A fake AppTable server, as a `fetch` function: no network in the tests.
//
// It answers the calls the integration makes with the shapes the AppTable web
// app reads, and records every request so a test can assert on them (how many
// menu requests, which headers, which body).
// -----------------------------------------------------------------------------

export const SETTINGS = {
  environment: 'production',
  apiDomain: 'https://api.apptable.test',
  apiKey: 'public-api-key',
  tenant: { name: "App'Table", theme: 'apptable', key: 'tenant-key' },
};

/** A JWT whose payload carries `exp` (seconds). The signature is not checked. */
export function jwt(exp) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ exp })}.signature`;
}

/** A menu of the /menus answer. */
export function menuOf(date, dishes = ['Carottes râpées', 'Poulet basquaise', 'Yaourt']) {
  const courses = ['ENTREE', 'PLAT', 'DESSERT'];
  return {
    date: `${date}T00:00:00`,
    animation: null,
    prestations: [
      {
        id: 1,
        name: 'DEJEUNER',
        ordre: 1,
        famillePlats: dishes.map((dish, index) => ({
          id: index + 1,
          name: courses[index] ?? `PLAT ${index}`,
          ordre: index + 1,
          plats: [{ name: dish.toUpperCase(), ordre: 1 }],
        })),
      },
    ],
  };
}

export const CHILDREN = [
  {
    id: 11,
    firstName: 'Léa',
    etablissement: { name: 'École Jules Ferry', restaurantId: 501 },
    section: { id: 7, code: 'ELEM' },
    bonAppFacturationConviveId: 9011,
  },
  {
    id: 12,
    firstName: 'Tom',
    etablissement: { name: 'École Jules Ferry', restaurantId: 501 },
    section: { id: 7, code: 'ELEM' },
    bonAppFacturationConviveId: 9012,
  },
];

/**
 * @param {object} [state] what the server answers; every field can be changed
 *   between two calls
 */
export function createFakeAppTable(state = {}) {
  const server = {
    password: 'secret',
    children: structuredClone(CHILDREN),
    // restaurantId|sectionId -> list of menus (any day)
    menus: {},
    // billing id -> { 'YYYY-MM-DD': true|false }
    bookings: {},
    invoices: [],
    tokenExp: Math.floor(Date.now() / 1000) + 3600,
    failures: {}, // path -> HTTP status to answer once
    requests: [],
    ...state,
  };

  function reply(status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  }

  server.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.requests.push({ url, path: pathname, method: init.method, headers: init.headers, body });

    if (url === 'https://apptable.elior.com/client-settings.json') {
      return reply(200, SETTINGS);
    }
    if (!url.startsWith(SETTINGS.apiDomain)) {
      return reply(404);
    }
    if (server.failures[pathname]) {
      const status = server.failures[pathname];
      delete server.failures[pathname];
      return reply(status);
    }
    if (pathname === '/api/v1/auth') {
      if (body.password !== server.password) {
        return reply(400, { message: 'invalid' });
      }
      return reply(200, { accessToken: jwt(server.tokenExp), refreshToken: 'refresh-1' });
    }
    if (pathname === '/api/v1/auth/refresh') {
      return reply(200, { accessToken: jwt(server.tokenExp), refreshToken: 'refresh-2' });
    }
    if (!init.headers?.authorization?.startsWith('Bearer ')) {
      return reply(401);
    }
    switch (pathname) {
      case '/api/v1/user/get-convive-list':
        return reply(200, server.children);
      case '/api/v1/menus': {
        const all = server.menus[`${body.restaurantId}|${body.sectionId}`] ?? [];
        // Like the real API, the answer may hold more than the asked day.
        return reply(200, { menusFound: all, societeJuridique: null });
      }
      case '/api/v1/convive-consommations': {
        const days = server.bookings[body.bonAppFacturationConviveId] ?? {};
        return reply(200, {
          datas: {
            consommations: Object.entries(days).map(([day, booked]) => ({
              jour: `${day}T00:00:00Z`,
              inscriptionConsommations: [{ inscriptionId: 1, prestationId: 1, isOrdered: booked }],
            })),
            orderableWeekDaysByInscription: [],
          },
        });
      }
      case '/api/v1/factures':
        return reply(200, server.invoices);
      default:
        return reply(404);
    }
  };

  /** The requests made to one API path. */
  server.calls = (path) => server.requests.filter((request) => request.path === path);
  return server;
}
