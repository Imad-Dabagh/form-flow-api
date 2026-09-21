import { BaseServices } from "../../_shared/index.js";
import Model from "../models/index.js";

const services = BaseServices(Model);

export const {
  archiveById,
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
  updateOne,
} = services;

export default services;
