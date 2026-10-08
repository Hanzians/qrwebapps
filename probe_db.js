const { all } = require('./backend/db');
(async () => {
  try {
    const info = await all("PRAGMA table_info(users)");
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
