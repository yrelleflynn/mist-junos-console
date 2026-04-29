/**
 * Mist cloud domains mapped to their cloud IDs.
 * Mirrors the MIST_CLOUDS catalog in @marvis/shared without importing it,
 * since service workers cannot use npm packages directly.
 */
const CLOUD_DOMAIN_MAP = [
  { domain: 'manage.mist.com',           cloud: 'global01'  },
  { domain: 'manage.gc1.mist.com',       cloud: 'global02'  },
  { domain: 'manage.gc2.mist.com',       cloud: 'global03'  },
  { domain: 'manage.gc3.mist.com',       cloud: 'global04'  },
  { domain: 'manage.gc4.mist.com',       cloud: 'global05'  },
  { domain: 'manage.eu.mist.com',        cloud: 'emea01'    },
  { domain: 'manage.ac2.mist.com',       cloud: 'apac01'    },
  { domain: 'manage.usgov1.mistsys.net', cloud: 'us-gov-1'  },
  { domain: 'manage.usgov2.mistsys.net', cloud: 'us-gov-2'  },
];

async function getMistSession() {
  for (const { domain, cloud } of CLOUD_DOMAIN_MAP) {
    const cookies = await chrome.cookies.getAll({ domain });
    const csrf = cookies.find((c) => c.name === 'csrftoken')?.value;
    const sessionId = cookies.find((c) => c.name === 'sessionid')?.value;
    if (csrf && sessionId) {
      return { cloud, csrfToken: csrf, sessionId };
    }
  }
  return null;
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-mist-session') {
    getMistSession().then((session) => sendResponse(session));
    return true; // keep message channel open for async response
  }
});
