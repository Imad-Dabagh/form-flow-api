import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/form-stage/models/index";

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
