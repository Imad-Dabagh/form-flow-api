import { BaseServices } from "../../_shared";
import Model from "../models";

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
