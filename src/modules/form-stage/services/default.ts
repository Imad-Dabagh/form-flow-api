import { BaseServices } from "../../_shared/index.js";
import Model from "../models/index.js";

const services = BaseServices(Model);

export const {
  countDocuments,
  createOne,
  deleteById,
  deleteOne,
  exists,
  existsById,
  fetchAll,
  fetchById,
  fetchOne,
  updateById,
  updateMany,
  updateOne,
} = services;

export default services;
