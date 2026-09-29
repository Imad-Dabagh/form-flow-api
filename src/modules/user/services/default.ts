import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/user/models/index";

const services = BaseServices(Model);

export const {
  createOne,
  exists,
  existsById,
  fetchAll,
  fetchById,
  fetchOne,
  updateById,
  updateOne,
} = services;

export default services;
