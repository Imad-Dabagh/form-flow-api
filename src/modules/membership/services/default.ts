import { BaseServices } from "../../_shared/index.js";
import Model from "../models/index.js";

const services = BaseServices(Model);

export const {
  createOne,
  deleteById,
  deleteOne,
  exists,
  fetchAll,
  fetchById,
  fetchOne,
  updateById,
  updateOne,
} = services;

export default services;
