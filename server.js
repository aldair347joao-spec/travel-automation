require("dotenv").config();

const app = require("./src/api/server");

const PORT = Number(process.env.PORT || 10000);

app.listen(PORT, () => {
  console.log("==========================================");
  console.log("TRAVEL AUTOMATION");
  console.log("==========================================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log("==========================================");
});
