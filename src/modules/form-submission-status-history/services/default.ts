import { BaseServices } from "#app/modules/_shared/index";
import Model from "#app/modules/form-submission-status-history/models/index";

const services = BaseServices(Model);

export const { createOne, fetchAll, findMany } = services;

export default services;
