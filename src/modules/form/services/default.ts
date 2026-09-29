import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/form/models/index";

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
