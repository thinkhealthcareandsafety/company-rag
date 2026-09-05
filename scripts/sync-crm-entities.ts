import { syncCrmEntities } from "../src/lib/crm/syncEntities";

syncCrmEntities()
  .then((summary) => {
    console.log("CRM entity index synced:", summary);
    process.exit(0);
  })
  .catch((err) => {
    console.error("CRM entity sync failed:", err);
    process.exit(1);
  });
