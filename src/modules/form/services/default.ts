import { BaseServices } from "../../_shared";
import Model from "../models";

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
