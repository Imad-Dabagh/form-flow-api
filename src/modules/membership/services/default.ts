import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/membership/models/index";

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
