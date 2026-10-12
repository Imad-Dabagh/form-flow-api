import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/invitation/models/index";

const services = BaseServices(Model);

export const {
  createOne,
  deleteById,
  fetchById,
  fetchOne,
  findMany,
  updateById,
  updateMany,
} = services;

export default services;
