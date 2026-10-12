import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/form-submission-status/models/index";

const services = BaseServices(Model);

export const { bulkWrite, fetchById, fetchOne, findMany } = services;

export default services;
