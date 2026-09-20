import { BaseServices } from "../../_shared";
import Model from "../models";

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
