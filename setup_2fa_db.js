const { run } = require('./backend/db');
(async () => {
  try {
    await run("ALTER TABLE users ADD COLUMN totp_secret TEXT");
    console.log("totp_secret added");
  } catch (e) {
    if (e.message.includes("duplicate column name")) {
      console.log("Column exists");
    } else {
      console.error(e);
    }
  } finally {
    process.exit();
  }
})();
