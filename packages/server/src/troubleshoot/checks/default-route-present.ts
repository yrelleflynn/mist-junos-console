import { registerCheck } from '../runner.js';

registerCheck('default-route-present', async (ctx) => {
  const { defaultGateway } = ctx;
  if (defaultGateway) {
    return { checkId: 'default-route-present', status: 'pass', summary: `Default route present via ${defaultGateway}` };
  }
  return {
    checkId: 'default-route-present',
    status: 'fail',
    summary: 'No default route (0.0.0.0/0) found — run: show route 0.0.0.0/0',
  };
});
