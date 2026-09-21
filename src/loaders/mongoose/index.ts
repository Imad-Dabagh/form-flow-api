import mongoose from "mongoose";
import config from "../../config/index.js";

export default async function mongooseLoader() {
  const connection = await mongoose.connect(config.mongoUri);
  const database = connection.connection.db;

  if (!database) {
    throw new Error("MongoDB database connection is unavailable.");
  }

  return {
    database,
    client: connection.connection.getClient(),
  };
}
