import { aroundAll, aroundEach } from "vitest";
import { runInTenantScope } from "../../db/tenant-pool";

// Fixtures are written across subjects, so tests start in the agency scope; code under
// test that opens its own scope narrows it as it would in the app.
aroundAll((runSuite) => runInTenantScope({ role: "visibility_agency" }, runSuite));
aroundEach((runTest) => runInTenantScope({ role: "visibility_agency" }, runTest));
