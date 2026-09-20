import mongoose from "mongoose";

export default async function mongooseLoader() {
  const databaseUrl = process.env.MONGO_URI;

  if (!databaseUrl) {
    throw new Error("MONGO_URI is required");
  }

  const connection = await mongoose.connect(databaseUrl);
  return connection.connection.db;
}
